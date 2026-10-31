import { writeFile } from 'node:fs/promises';
import { rtmVendorSource } from './rtm-vendor.js';

await writeFile(new URL('../src/rtm-vendor.js', import.meta.url), await rtmVendorSource());
