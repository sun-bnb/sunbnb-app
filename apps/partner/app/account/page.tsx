'use client'

import { useSession } from 'next-auth/react'
import { TextField } from '@repo/ui/TextField'
import { useEffect, useState } from 'react'

export default function Account() {

  const { data: session, status } = useSession()

  const [password, setPassword] = useState('')

  const [content, setContent] = useState<{
    email?: string
    firstName?: string
    lastName?: string
    company?: string
    phoneNumber?: string
    websiteUrl?: string
  } | null>(null)

  useEffect(() => {
    if (status === 'authenticated') {
      const fullName = session?.user?.name
      const email = session?.user?.email || ''
      const [firstName, lastName] = fullName?.split(' ') || []
      setContent({
        email,
        firstName,
        lastName
      })
    }
  }, [status])

  return (
    
    <div className="container mx-auto px-4">
      <form>
          <div className="grid gap-6 mb-6 md:grid-cols-2">
            <TextField label="E-mail" placeholder="john.doe@company.com" value={content?.email || ''} onChange={(event) => {
                setContent({
                  ...content,
                  email: event.target.value
                })
              }}/>
              <TextField type="password" label="Password" placeholder="********" value={password} onChange={(event) => {
                setPassword(event.target.value)
              }}/>
          </div>
          <div className="grid gap-6 mb-6 md:grid-cols-2">
              <TextField label="First name" placeholder="John" value={content?.firstName || ''} onChange={(event) => {
                setContent({
                  ...content,
                  firstName: event.target.value
                })
              }}/>
              <TextField label="Last name" placeholder="Doe" value={content?.lastName || ''} onChange={(event) => {
                setContent({
                  ...content,
                  lastName: event.target.value
                })
              }}/>
              <TextField label="Company" placeholder="Flowbite" value={content?.company || ''} onChange={(event) => {
                setContent({
                  ...content,
                  company: event.target.value
                })
              }}/>
              <TextField label="Phone number" placeholder="123-45-678" value={content?.phoneNumber || ''} onChange={(event) => {
                setContent({
                  ...content,
                  phoneNumber: event.target.value
                })
              }}/>
              <TextField label="Website URL" placeholder="flowbite.com" value={content?.websiteUrl || ''} onChange={(event) => {
                setContent({
                  ...content,
                  websiteUrl: event.target.value
                })
              }}/>
          </div>
          <button type="submit" className="text-white bg-blue-700 hover:bg-blue-800 focus:ring-4 focus:outline-none focus:ring-red-300 font-medium rounded-lg text-sm w-full sm:w-auto px-5 py-2.5 text-center dark:bg-blue-600 dark:hover:bg-blue-700 dark:focus:ring-blue-800">Save</button>
      </form>

    </div>
  );
}
