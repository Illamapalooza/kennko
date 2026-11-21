import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'coffee.kennko.wall',
  appName: 'Kennko Wall',
  webDir: 'www-probe',
  server: {
    androidScheme: 'http',
  },
}

export default config
