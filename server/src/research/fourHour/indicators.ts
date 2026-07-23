export interface RobustScore {
  median: number;
  mad: number;
  scale: number;
  z: number;
}

export interface OlsFit {
  alpha: number;
  beta: number;
  residuals: number[];
  residualScale: number;
}

function allFinite(values: readonly number[]): boolean {
  return values.every(Number.isFinite);
}

/** Frozen even-sample convention: arithmetic mean of the two central values. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0 || !allFinite(values)) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[midpoint];
  const result = (sorted[midpoint - 1] + sorted[midpoint]) / 2;
  return Number.isFinite(result) ? result : null;
}

export function logReturn(previousClose: number, currentClose: number): number | null {
  if (!Number.isFinite(previousClose)
    || !Number.isFinite(currentClose)
    || previousClose <= 0
    || currentClose <= 0) {
    return null;
  }
  const result = Math.log(currentClose / previousClose);
  return Number.isFinite(result) ? result : null;
}

export function robustScore(
  current: number,
  reference: readonly number[],
  scaleFactor: number,
): RobustScore | null {
  if (!Number.isFinite(current)
    || !Number.isFinite(scaleFactor)
    || !(scaleFactor > 0)
    || reference.length === 0
    || !allFinite(reference)) return null;
  const center = median(reference);
  if (center === null) return null;
  const deviations = reference.map((value) => Math.abs(value - center));
  const mad = median(deviations);
  if (mad === null) return null;
  const scale = scaleFactor * mad;
  if (!(scale > 0) || !Number.isFinite(scale)) return null;
  const z = (current - center) / scale;
  if (!Number.isFinite(z)) return null;
  return { median: center, mad, scale, z };
}

/** OLS with an intercept and the frozen residual standard error denominator n - 2. */
export function fitOlsWithIntercept(
  driver: readonly number[],
  response: readonly number[],
): OlsFit | null {
  if (driver.length !== response.length
    || driver.length < 3
    || !allFinite(driver)
    || !allFinite(response)) {
    return null;
  }

  const count = driver.length;
  const xBar = driver.reduce((sum, value) => sum + value, 0) / count;
  const yBar = response.reduce((sum, value) => sum + value, 0) / count;
  if (!Number.isFinite(xBar) || !Number.isFinite(yBar)) return null;

  let driverSquaredDeviations = 0;
  let crossDeviations = 0;
  for (let index = 0; index < count; index += 1) {
    const xDeviation = driver[index] - xBar;
    driverSquaredDeviations += xDeviation ** 2;
    crossDeviations += xDeviation * (response[index] - yBar);
  }
  if (!(driverSquaredDeviations > 0) || !Number.isFinite(driverSquaredDeviations)) return null;

  const beta = crossDeviations / driverSquaredDeviations;
  const alpha = yBar - beta * xBar;
  if (!Number.isFinite(alpha) || !Number.isFinite(beta)) return null;

  const residuals = driver.map((value, index) => (
    response[index] - (alpha + beta * value)
  ));
  if (!allFinite(residuals)) return null;
  const residualSumSquares = residuals.reduce((sum, residual) => sum + residual ** 2, 0);
  const residualScale = Math.sqrt(residualSumSquares / (count - 2));
  if (!(residualScale > 0) || !Number.isFinite(residualScale)) return null;

  return { alpha, beta, residuals, residualScale };
}
