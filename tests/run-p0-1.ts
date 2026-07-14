import { P0_1_TEST_FILES } from './p0-1-suite-files.js'

for (const file of P0_1_TEST_FILES) {
  await import(new URL(`./${file}`, import.meta.url).href)
}
