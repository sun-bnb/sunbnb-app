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
      <div className="flex max-w-lg mx-auto bg-[#fff5e1]">
        <div className="flex-grow">
          {children}
        </div>
      </div>
    </div>  
  )

}

export default UnauthenticatedApp