import * as React from 'react'

interface Props {
}

function ControlPanel({
}: Props) {
  return (
    <div className="control-panel">
      <h3>Select site location</h3>

      <p>
        Search for the site location or select it on the map
      </p>
    </div>
  )
}

export default React.memo(ControlPanel)
