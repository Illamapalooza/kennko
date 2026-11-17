// Ice rules are shared with the till, so an online order and a counter order read the same to a barista.
export {
  ICE_LEVELS, ICE_SERVES, iceSummary, normaliseIce, takesIce, takesIceServe,
  type IceLevel, type IceServe,
} from '@kennko/core'
