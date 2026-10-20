import { config } from '../src/lib/config.js';
import { verifyModel } from '../src/lib/openai.js';

console.log('OPENAI_MODEL =', config.openaiModel);
try {
  await verifyModel();
  console.log('OK: the API accepts this model');
} catch (error) {
  console.log('REJECTED:', error instanceof Error ? error.message : String(error));
}
