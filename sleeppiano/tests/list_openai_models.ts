import { openai } from '../src/lib/openai.js';
const page = await openai().models.list();
const ids = page.data.map((m) => m.id).sort();
console.log('total:', ids.length);
console.log('gpt-5*   :', ids.filter((i) => i.startsWith('gpt-5')).join(', ') || '(none)');
console.log('gpt-4.1* :', ids.filter((i) => i.startsWith('gpt-4.1')).join(', ') || '(none)');
console.log('luna?    :', ids.filter((i) => i.includes('luna')).join(', ') || '(none)');
console.log('gpt-4o*  :', ids.filter((i) => i.startsWith('gpt-4o')).slice(0, 6).join(', ') || '(none)');
