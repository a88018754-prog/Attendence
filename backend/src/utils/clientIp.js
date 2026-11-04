import { isIP } from 'node:net';
import ipaddr from 'ipaddr.js';

export function getPublicClientIp(req) {
  const detectedIp = req.ip;
  if (!detectedIp || !isIP(detectedIp)) {
    return { ip: null, detectedIp: detectedIp || null, reason: 'unavailable' };
  }

  try {
    const address = ipaddr.process(detectedIp);
    if (address.range() !== 'unicast') {
      return {
        ip: null,
        detectedIp: address.toString(),
        reason: address.range(),
      };
    }

    return {
      ip: address.toString(),
      detectedIp: address.toString(),
      reason: null,
    };
  } catch {
    return { ip: null, detectedIp, reason: 'invalid' };
  }
}
