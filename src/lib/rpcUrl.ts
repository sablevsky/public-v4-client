const HTTP_PROTOCOL_PATTERN = /^https?:\/\//i;

const getHostFromUrlWithoutProtocol = (url: string) => {
  const hostWithPort = url.split(/[/?#]/)[0];

  if (hostWithPort.startsWith('[')) {
    return hostWithPort.slice(0, hostWithPort.indexOf(']') + 1).toLowerCase();
  }

  return hostWithPort.split(':')[0].toLowerCase();
};

const isLocalRpcHost = (host: string) => {
  return host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' || host === '[::1]';
};

const inferProtocol = (url: string) => {
  return isLocalRpcHost(getHostFromUrlWithoutProtocol(url)) ? 'http' : 'https';
};

export const normalizeRpcUrl = (url: string) => {
  const trimmedUrl = url.trim();
  if (!trimmedUrl) {
    return null;
  }

  const urlWithProtocol = HTTP_PROTOCOL_PATTERN.test(trimmedUrl)
    ? trimmedUrl
    : `${inferProtocol(trimmedUrl)}://${trimmedUrl}`;

  try {
    const parsedUrl = new URL(urlWithProtocol);
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return null;
    }

    if (!parsedUrl.hostname) {
      return null;
    }

    if (parsedUrl.pathname === '/' && !parsedUrl.search && !parsedUrl.hash) {
      return `${parsedUrl.protocol}//${parsedUrl.host}`;
    }

    return parsedUrl.toString();
  } catch (error) {
    return null;
  }
};

export const isValidRpcUrl = (url: string) => normalizeRpcUrl(url) !== null;
