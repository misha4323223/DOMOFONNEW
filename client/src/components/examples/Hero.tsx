import { Hero } from '../Hero'

export default function HeroExample() {
  return <Hero onRequestClick={() => console.log('Request button clicked')} />
}
