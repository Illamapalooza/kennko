import { Nav } from '@/components/site/Nav'
import { Hero } from '@/components/site/Hero'
import { About } from '@/components/site/About'
import { MenuSection } from '@/components/site/MenuSection'
import { FoodMenu } from '@/components/site/FoodMenu'
import { Perks } from '@/components/site/Perks'
import { Visit } from '@/components/site/Visit'
import { Footer } from '@/components/site/Footer'
import { getMenu, getFoodMenu } from '@/lib/menu/queries'
import './landing.css'

export const revalidate = 60

export default async function HomePage() {
  const [categories, food] = await Promise.all([getMenu(), getFoodMenu()])

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
