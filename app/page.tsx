import { Nav } from '@/components/site/Nav'
import { Hero } from '@/components/site/Hero'
import { About } from '@/components/site/About'
import { MenuSection } from '@/components/site/MenuSection'
import { Perks } from '@/components/site/Perks'
import { Visit } from '@/components/site/Visit'
import { Footer } from '@/components/site/Footer'

export default function HomePage() {
  return (
    <>
      <Nav />
      <main id="top">
        <Hero />
        <About />
        <MenuSection />
        <Perks />
        <Visit />
      </main>
      <Footer />
    </>
  )
}
