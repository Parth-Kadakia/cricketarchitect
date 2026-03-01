export function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function randomFloat(min, max) {
  return Math.random() * (max - min) + min;
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function toOverNotation(balls) {
  const overs = Math.floor(balls / 6);
  const ballsInOver = balls % 6;
  return Number(`${overs}.${ballsInOver}`);
}

export function weightedChoice(items) {
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  let cursor = Math.random() * total;

  for (const item of items) {
    cursor -= item.weight;
    if (cursor <= 0) {
      return item.value;
    }
  }

  return items[items.length - 1].value;
}
