/** Build the Agora duplex endpoint; numeric Uid and JWT uid must identify the same user. */
export function agoraEndpoint(connection) {
  if (!connection || typeof connection !== 'object') {
    throw new TypeError('An Agora connection is required.');
  }
  const { baseURL, channel, uid, stringUid = `aiui-${uid}` } = connection;
  const base = new URL(baseURL);
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) {
    throw new TypeError(
      'Agora baseURL must be an HTTPS URL without credentials, query or fragment.',
    );
  }
  if (base.pathname !== '/' && base.pathname !== '') {
    throw new TypeError('Agora baseURL must contain only the server origin.');
  }
  if (typeof channel !== 'string' || !channel || channel.length > 64) {
    throw new TypeError('Agora channel must contain 1 to 64 characters.');
  }
  if (!Number.isInteger(uid) || uid < 1 || uid > 4_294_967_294) {
    throw new TypeError('Agora uid must be an integer from 1 to 4294967294.');
  }
  if (typeof stringUid !== 'string' || !stringUid || stringUid.length > 255) {
    throw new TypeError('Agora stringUid must contain 1 to 255 characters.');
  }
  return `${base.origin}/pub/${encodeURIComponent(channel)}?stringuid=${encodeURIComponent(stringUid)}&Uid=${uid}&duplex=true`;
}

export function whipOptions(connection) {
  if (typeof connection.token !== 'string' && typeof connection.token !== 'function') {
    throw new TypeError('An Agora WHIP token or token callback is required.');
  }
  return {
    rtcConfiguration: { bundlePolicy: 'max-bundle', ...connection.rtcConfiguration },
    mediaMode: 'duplex',
    response: {
      acceptedStatuses: 'any-2xx',
      requireLocation: false,
      requireContentType: false,
    },
    authorization: async () => {
      const token =
        typeof connection.token === 'function' ? await connection.token() : connection.token;
      if (typeof token !== 'string' || !token.trim() || /[\r\n]/.test(token)) {
        throw new TypeError('The Agora WHIP token is invalid.');
      }
      return `Bearer ${token}`;
    },
  };
}
