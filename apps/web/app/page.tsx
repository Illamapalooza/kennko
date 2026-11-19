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
import type { MenuSnapshot } from '@kennko/core'
import './landing.css'

export const revalidate = 60

export default async function HomePage() {
  // An API outage must not take the landing page down: render empty menu sections instead.
  let snapshot: MenuSnapshot | null = null
  try {
    snapshot = await fetchMenuSnapshot()
  } catch (err) {
    console.error('Could not load the menu for the landing page', err)
  }
  const categories = menuFromSnapshot(snapshot)
  const food = foodFromSnapshot(snapshot)

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
