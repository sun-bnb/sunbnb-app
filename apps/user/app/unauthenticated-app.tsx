'use client'

import LightHeader from './header/light-header'

const UnauthenticatedApp = ({ children }: {
  children: React.ReactNode;
}) => {

  return (
    <div>
      <div
        className={`fixed top-0 left-0 right-0 z-50`}>
        <LightHeader />
      </div>
      <div className="bg-cream">
        {children}
      </div>
    </div>  
  )

}

export default UnauthenticatedApp