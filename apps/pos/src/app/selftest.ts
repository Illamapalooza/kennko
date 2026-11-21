import { runSqlContract } from '../../till/sql-contract.ts'
import { bridgeSelftestPath, openBridgeSqlite } from './sqlite-bridge.ts'

export function runSelfTest(): void {
  const failures = runSqlContract(openBridgeSqlite, bridgeSelftestPath())
  if (failures.length === 0) {
    console.log('KENNKO_SELFTEST PASS')
  } else {
    console.error(`KENNKO_SELFTEST FAIL ${failures.join('; ')}`)
  }
}
