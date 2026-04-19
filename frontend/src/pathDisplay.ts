export function basenameFromPath(path: string) {
  const normalized = path.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : path;
}

function middleEllipsisSegment(value: string, maxLength: number) {
  if (maxLength <= 0) return '';
  if (value.length <= maxLength) return value;
  if (maxLength <= 3) return value.slice(-maxLength);

  const headLength = Math.min(5, maxLength - 3);
  const tailLength = maxLength - headLength - 3;
  const tail = tailLength > 0 ? value.slice(-tailLength) : '';
  return `${value.slice(0, headLength)}...${tail}`;
}

export function middleEllipsisPath(path: string, maxLength = 36) {
  if (maxLength <= 0) return '';
  if (path.length <= maxLength) return path;

  if (!path.includes('/') && !path.includes('\\')) {
    return middleEllipsisSegment(path, maxLength);
  }

  const separator = path.includes('\\') && !path.includes('/') ? '\\' : '/';
  const normalized = path.replace(/\\/g, '/');
  const displayPath = separator === '\\' ? normalized.replace(/\//g, '\\') : normalized;
  const basename = basenameFromPath(displayPath);
  const head = displayPath.startsWith('/') ? '/' : '';
  const prefix = `${head}${displayPath.slice(head.length, head.length + 5)}...${separator}`;
  const remaining = maxLength - prefix.length;

  if (remaining <= 0) return prefix.slice(0, maxLength);
  if (basename.length <= remaining) return `${prefix}${basename}`;
  if (remaining <= 3) return `${prefix}${basename.slice(-remaining)}`;
  return `${prefix}...${basename.slice(-(remaining - 3))}`;
}

export function fitPathToWidth(
  path: string,
  maxWidth: number,
  measureText: (value: string) => number,
) {
  if (maxWidth <= 0) {
    return middleEllipsisPath(path, 1);
  }

  if (measureText(path) <= maxWidth) {
    return path;
  }

  let low = 1;
  let high = path.length;
  let bestFit = middleEllipsisPath(path, 1);

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = middleEllipsisPath(path, middle);

    if (measureText(candidate) <= maxWidth) {
      bestFit = candidate;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  return bestFit;
}
