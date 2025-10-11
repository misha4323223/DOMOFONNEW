import { Header } from '../Header'

export default function HeaderExample() {
  return <Header onRequestClick={() => console.log('Request clicked')} />
}
