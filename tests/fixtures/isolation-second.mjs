if (process.env.PHASE1_ISOLATION_SENTINEL !== undefined) {
  throw new Error('suite environment leaked across the process boundary')
}
console.log(JSON.stringify({ event: 'second:start', pid: process.pid }))
