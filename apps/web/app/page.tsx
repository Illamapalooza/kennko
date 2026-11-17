import { Nav } from '@/components/site/Nav'
import { Hero } from '@/components/site/Hero'
import { About } from '@/components/site/About'
import { MenuSection } from '@/components/site/MenuSection'
import { Perks } from '@/components/site/Perks'
import { Visit } from '@/components/site/Visit'
import { Footer } from '@/components/site/Footer'
import { getMenu } from '@/lib/menu/queries'

export const revalidate = 60

export default async function HomePage() {
  const categories = await getMenu()

  return (
    <>
      <Nav />
      <main id="top">
        <Hero />
        <About />
        <MenuSection categories={categories} />
        <Perks />
        <Visit />
      </main>
      <Footer />
    </>
  )
}
