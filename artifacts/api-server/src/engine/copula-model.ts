/**
 * Copula-Based Bivariate Goal Model
 *
 * Methods implemented:
 * M47 — Frank Copula (negative/positive goal correlation)
 * M48 — Gumbel Copula (upper tail dependence — both teams score high together)
 * M49 — Clayton Copula (lower tail dependence — goalless draws cluster)
 *
 * References:
 *   Sklar (1959) "Fonctions de répartition à n dimensions et leurs marges"
 *   Nelsen (2006) "An Introduction to Copulas"
 *   Boshnakov et al (2017) "A bivariate Weibull count model for football results"
 */

/** Poisson CDF */
function poissonCDF(k: number, lambda: number): number {
  let sum = 0;
  for (let i = 0; i <= Math.floor(k); i++) {
    sum += poissonPMF(i, lambda);
  }
  return Math.min(1, sum);
}

function poissonPMF(k: number, lambda: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let logP = -lambda + k * Math.log(lambda);
  for (let i = 1; i <= k; i++) logP -= Math.log(i);
  return Math.exp(logP);
}

export interface CopulaInput {
  lambdaHome: number;
  lambdaAway: number;
  /** Goal correlation: positive = goals cluster together, negative = one team scores when other doesn't */
  goalCorrelation?: number;  // ρ ∈ (-1, 1)
  /** Copula type — auto-selected based on correlation sign if not specified */
  copulaType?: "frank" | "gumbel" | "clayton" | "auto";
}

export interface CopulaResult {
  scoreMatrix: number[][];
  copulaType: string;
  copulaParameter: number;
  /** Joint probability of both teams scoring */
  probBothScore: number;
  /** Probability of 0-0 (copula-corrected) */
  prob00: number;
  /** Tail dependence coefficients */
  upperTailDependence: number;
  lowerTailDependence: number;
}

/**
 * Frank copula density:
 * c(u,v;θ) = -θ(e^θ - 1)e^(θ(u+v)) / [(e^θ - 1 + (e^θu - 1)(e^θv - 1))²]
 */
function frankCopulaCDF(u: number, v: number, theta: number): number {
  if (Math.abs(theta) < 1e-6) return u * v; // independence
  const num = (Math.exp(-theta * u) - 1) * (Math.exp(-theta * v) - 1);
  const den = Math.exp(-theta) - 1;
  return -Math.log(1 + num / den) / theta;
}

/**
 * Gumbel copula CDF:
 * C(u,v;θ) = exp(-[(-ln u)^θ + (-ln v)^θ]^(1/θ))
 */
function gumbelCopulaCDF(u: number, v: number, theta: number): number {
  if (theta <= 1) return u * v;
  const t = theta;
  const inner = Math.pow(-Math.log(Math.max(1e-10, u)), t) +
                Math.pow(-Math.log(Math.max(1e-10, v)), t);
  return Math.exp(-Math.pow(inner, 1 / t));
}

/**
 * Clayton copula CDF:
 * C(u,v;θ) = (u^(-θ) + v^(-θ) - 1)^(-1/θ)
 */
function claytonCopulaCDF(u: number, v: number, theta: number): number {
  if (theta <= 0) return u * v;
  return Math.pow(
    Math.max(0, Math.pow(u, -theta) + Math.pow(v, -theta) - 1),
    -1 / theta,
  );
}

/**
 * Goal correlation ρ → Frank copula parameter θ
 * Approximation: θ ≈ 12ρ (Pearson rho to Kendall tau scaling for Frank)
 */
function correlationToFrankTheta(rho: number): number {
  // Frank copula: Kendall's τ = 1 - 4/θ × (1 - D₁(θ))
  // Simple approximation: θ ≈ 5.74 × τ for |τ| < 0.5
  const tau = rho * 0.75; // approximate conversion
  return 5.74 * tau;
}

function correlationToGumbelTheta(rho: number): number {
  // Gumbel: τ = 1 - 1/θ → θ = 1/(1-τ)
  const tau = Math.max(0.01, rho * 0.75);
  return Math.max(1.01, 1 / (1 - tau));
}

function correlationToClaytonTheta(rho: number): number {
  // Clayton: τ = θ/(θ+2) → θ = 2τ/(1-τ)
  const tau = Math.max(0.01, Math.abs(rho) * 0.75);
  return (2 * tau) / (1 - tau);
}

export function computeCopula(input: CopulaInput): CopulaResult {
  const {
    lambdaHome,
    lambdaAway,
    goalCorrelation = 0.1,
    copulaType = "auto",
  } = input;

  // Select copula type
  let selectedType: "frank" | "gumbel" | "clayton";
  if (copulaType === "auto") {
    if (goalCorrelation > 0.15) selectedType = "gumbel";     // positive tail cluster
    else if (goalCorrelation < -0.05) selectedType = "clayton"; // lower tail (0-0 cluster)
    else selectedType = "frank";                               // symmetric
  } else {
    selectedType = copulaType;
  }

  let copulaParameter: number;
  let cdfFn: (u: number, v: number) => number;
  let upperTailDep: number;
  let lowerTailDep: number;

  if (selectedType === "frank") {
    copulaParameter = correlationToFrankTheta(goalCorrelation);
    cdfFn = (u, v) => frankCopulaCDF(u, v, copulaParameter);
    upperTailDep = 0; // Frank has no tail dependence
    lowerTailDep = 0;
  } else if (selectedType === "gumbel") {
    copulaParameter = correlationToGumbelTheta(goalCorrelation);
    cdfFn = (u, v) => gumbelCopulaCDF(u, v, copulaParameter);
    upperTailDep = 2 - 2 ** (1 / copulaParameter); // upper tail dependence
    lowerTailDep = 0;
  } else {
    // Clayton
    copulaParameter = correlationToClaytonTheta(Math.abs(goalCorrelation));
    cdfFn = (u, v) => claytonCopulaCDF(u, v, copulaParameter);
    upperTailDep = 0;
    lowerTailDep = 2 ** (-1 / copulaParameter); // lower tail dependence
  }

  // Build score matrix using copula
  // P(H=h, A=a) = C(F_H(h), F_A(a)) - C(F_H(h-1), F_A(a)) - C(F_H(h), F_A(a-1)) + C(F_H(h-1), F_A(a-1))
  const maxGoals = 8;
  const scoreMatrix: number[][] = [];

  // Pre-compute marginal CDFs
  const cdfHome: number[] = [];
  const cdfAway: number[] = [];
  for (let k = -1; k <= maxGoals; k++) {
    cdfHome[k + 1] = k < 0 ? 0 : poissonCDF(k, lambdaHome);
    cdfAway[k + 1] = k < 0 ? 0 : poissonCDF(k, lambdaAway);
  }

  let probBothScore = 0;
  let prob00 = 0;

  for (let h = 0; h <= maxGoals; h++) {
    scoreMatrix[h] = [];
    for (let a = 0; a <= maxGoals; a++) {
      const uH = cdfHome[h + 1];
      const uHm1 = cdfHome[h]; // h-1 → index h
      const vA = cdfAway[a + 1];
      const vAm1 = cdfAway[a];

      const p =
        cdfFn(uH, vA) -
        cdfFn(uHm1, vA) -
        cdfFn(uH, vAm1) +
        cdfFn(uHm1, vAm1);

      scoreMatrix[h][a] = Math.max(0, p);

      if (h > 0 && a > 0) probBothScore += scoreMatrix[h][a];
      if (h === 0 && a === 0) prob00 = scoreMatrix[h][a];
    }
  }

  // Normalize to ensure sum = 1
  let total = 0;
  for (let h = 0; h <= maxGoals; h++) {
    for (let a = 0; a <= maxGoals; a++) {
      total += scoreMatrix[h][a];
    }
  }
  if (total > 0) {
    for (let h = 0; h <= maxGoals; h++) {
      for (let a = 0; a <= maxGoals; a++) {
        scoreMatrix[h][a] /= total;
      }
    }
  }

  return {
    scoreMatrix,
    copulaType: selectedType,
    copulaParameter,
    probBothScore,
    prob00,
    upperTailDependence: upperTailDep,
    lowerTailDependence: lowerTailDep,
  };
}
