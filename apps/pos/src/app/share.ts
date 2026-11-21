import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'

export async function shareFile(path: string, title: string): Promise<void> {
  const rel = path.includes('/files/') ? path.split('/files/')[1]! : path
  const { uri } = await Filesystem.getUri({ path: rel, directory: Directory.Data })
  await Share.share({ title, files: [uri] })
}

export async function shareText(filename: string, text: string): Promise<void> {
  await Filesystem.writeFile({
    path: filename,
    data: text,
    directory: Directory.Cache,
    encoding: Encoding.UTF8,
  })
  const { uri } = await Filesystem.getUri({ path: filename, directory: Directory.Cache })
  await Share.share({ title: filename, files: [uri] })
}
