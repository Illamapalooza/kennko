import { Nav } from '@/components/site/Nav'
import { Hero } from '@/components/site/Hero'
import { About } from '@/components/site/About'
import { MenuSection } from '@/components/site/MenuSection'
import { FoodMenu } from '@/components/site/FoodMenu'
import { Perks } from '@/components/site/Perks'
import { Visit } from '@/components/site/Visit'
import { Footer } from '@/components/site/Footer'
import { fetchMenuSnapshot } from '@/lib/menu/api'
import { foodFromSnapshot, menuFromSnapshot } from '@/lib/menu/queries'
import './landing.css'

export const revalidate = 60

export default async function HomePage() {
  // An API outage must not take the landing page down: render empty menu sections instead.
  // The mapping sits inside the try too, so a malformed 200 falls back the same way.
  let categories: ReturnType<typeof menuFromSnapshot> = []
  let food: ReturnType<typeof foodFromSnapshot> = []
  try {
    const snapshot = await fetchMenuSnapshot()
    categories = menuFromSnapshot(snapshot)
    food = foodFromSnapshot(snapshot)
  } catch (err) {
    console.error('Could not load the menu for the landing page', err)
  }

  return (
    <div className="landing k-paper-grid">
      <Nav />
      <main id="top">
        <Hero />
        <About />
        <MenuSection categories={categories} />
        <FoodMenu items={food} />
        <Perks />
        <Visit />
      </main>
      <Footer />
    </div>
  )
}
