import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'coffee.kennko.pos',
  appName: 'Kennko POS',
  webDir: 'dist-app',
  plugins: {
    CapacitorHttp: {
      enabled: false,
    },
    KennkoUpdate: {
      app: 'pos',
    },
  },
}

export default config
