import { STEP_LABELS, STEP_ORDER, stepState, type Step } from './nav'

type Props = { current: Step; onGo: (step: Step) => void }

export function StepBar({ current, onGo }: Props) {
  return (
    <ol className="step-bar" aria-label="Order steps">
      {STEP_ORDER.map((step, i) => {
        const state = stepState(step, current)
        const label = (
          <>
            <span className="step-num" aria-hidden="true">{state === 'done' ? '✓' : i + 1}</span>
            {STEP_LABELS[step]}
          </>
        )
        return (
          <li key={step} className={`step step-${state}`}>
            {state === 'done' ? (
              <button type="button" onClick={() => onGo(step)}>{label}</button>
            ) : (
              <span aria-current={state === 'current' ? 'step' : undefined}>{label}</span>
            )}
          </li>
        )
      })}
    </ol>
  )
}
