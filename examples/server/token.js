import { createHmac } from 'node:crypto';

/** Sign the duplex gateway JWT; this is separate from an Agora RTC AccessToken. */
export function createWhipToken({
  appId,
  certificate,
  channel,
  uid,
  lifetime = 600,
  now = Date.now(),
}) {
  if (
    typeof appId !== 'string' ||
    !/^[\da-f]{32}$/i.test(appId) ||
    typeof certificate !== 'string' ||
    !/^[\da-f]{32}$/i.test(certificate) ||
    typeof channel !== 'string' ||
    !channel ||
    channel.length > 64 ||
    !Number.isInteger(uid) ||
    uid < 1 ||
    uid > 4_294_967_294 ||
    !Number.isInteger(lifetime) ||
    lifetime < 1 ||
    lifetime > 86_400
  ) {
    throw new TypeError('Invalid WHIP signing configuration.');
  }
  const expires = Math.floor(now / 1000) + lifetime;
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const content = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
    version: '1.0',
    appID: appId,
    streamID: channel,
    uid: String(uid),
    exp: expires,
    action: 'pub',
    enableSubAuth: true,
  })}`;
  const signature = createHmac('sha256', certificate).update(content).digest('base64url');
  return { token: `${content}.${signature}`, tokenExpiresAt: expires * 1000 };
}
