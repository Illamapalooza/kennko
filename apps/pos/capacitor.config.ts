import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'coffee.kennko.pos',
  appName: 'Kennko POS',
  webDir: 'dist-app',
  plugins: {
    CapacitorHttp: {
      enabled: false,
    },
  },
}

export default config
