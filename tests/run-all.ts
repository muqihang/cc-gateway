import { readdirSync } from 'fs'

const files = readdirSync(new URL('.', import.meta.url))
  .filter((file) => file.endsWith('.test.ts'))
  .sort()

console.log(`Running ${files.length} test files`)

for (const file of files) {
  await import(new URL(`./${file}`, import.meta.url).href)
}
