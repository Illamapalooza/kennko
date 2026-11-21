import { CatToon } from '@kennko/cats'
import { ConnectTill } from '../components/ConnectTill.tsx'

type Props = { onConnected: () => void }

export function FirstRun({ onConnected }: Props) {
  return (
    <div className="gate">
      <img src="/brand/wordmark-blue.png" alt="Kennko Coffee" className="gate-logo" />
      <div className="gate-card">
        <CatToon coat="ginger" pose="peek" className="perch perch-peek perch-left" />
        <CatToon coat="tuxedo" pose="wave" className="perch perch-sit perch-right" />
        <h1>Connect this till</h1>
        <ConnectTill needsPin={false} inline onConnected={() => onConnected()} />
      </div>
    </div>
  )
}
