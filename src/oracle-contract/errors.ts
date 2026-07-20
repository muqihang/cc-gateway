export class OracleContractError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'OracleContractError'
  }
}

export function oracleError(code: string, message: string): never {
  throw new OracleContractError(code, message)
}
