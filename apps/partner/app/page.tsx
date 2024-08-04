import Image from 'next/image'
import { Button } from '@repo/ui/button'
import { signIn } from 'next-auth/react'
import styles from './page.module.css'

export default function Home() {
  return (
    <div className="container mx-auto px-4">
      Home
    </div>
  )
}
