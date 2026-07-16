console.log(JSON.stringify({ event: 'first:start', pid: process.pid }))
process.env.PHASE1_ISOLATION_SENTINEL = 'leaked-from-first'
await new Promise((resolve) => setTimeout(resolve, 40))
console.log(JSON.stringify({ event: 'first:end', pid: process.pid }))
