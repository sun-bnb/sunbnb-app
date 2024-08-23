'use client'

import { clockNumberClasses } from "@mui/x-date-pickers"
import { useEffect, useState } from "react"

function drawWavyLine(
  ctx: CanvasRenderingContext2D,
  effectStart: number,
  effectDuration: number,
  width: number,
  time: number,
  frequency: number,
  amplitude: number,
  speed: number,
  waveLength: number,
  color: string,
  shadowColor: string,
  shadowBlur: number) {
      
  if (!ctx) return

  const now = Date.now()

  ctx.shadowBlur = shadowBlur
  ctx.shadowColor = shadowColor

  ctx.beginPath()
  ctx.moveTo(0, 0)

  let waveLengthMultiplier = 1
  let effectMultiplier = 1
  
  //console.log(now, effectStart, effectDuration)
  if(now < effectStart + (effectDuration / 2)) {
    effectMultiplier = 1 - ((((now - effectStart) / (effectDuration / 2))) * 0.8)
  }

  if(now >= (effectStart + (effectDuration / 2)) && now < (effectStart + effectDuration)) {
    effectMultiplier = 0.2 + ((((now - (effectStart + (effectDuration / 2))) / (effectDuration / 2))) * 0.8)
    //console.log('waveLengthMultiplier (2) => ', waveLengthMultiplier)
  }

  function plotLine() {
    for (let x = 0; x < width; x++) {
      const varyingWaveLength = (waveLength + (Math.sin((x + time * speed) * frequency) * amplitude) * 0.5) * effectMultiplier
      const y = Math.sin((x / varyingWaveLength) + time * speed) * amplitude * (1 + ((1 - effectMultiplier)))
      ctx.lineTo(x, y)
    }
  }

  plotLine()

  ctx.strokeStyle = color
  ctx.lineWidth = 1 + ((1 - effectMultiplier) * 2)
  ctx.stroke()

  ctx.beginPath()
  ctx.moveTo(0, 0)

  plotLine()

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)'
  ctx.lineWidth = 2
  ctx.stroke()
}

export default function Glow({ state }: { state: string }) {

  const [ effectStart, setEffectStart ] = useState<number>(0)
  const [ effectDuration, setEffectDuration ] = useState<number>(0)
  const [ currentTime, setCurrentTime ] = useState<number>(0)

  const [ ctx, setCtx ] = useState<CanvasRenderingContext2D | null>(null)
  const [ width, setWidth ] = useState<number>(0)
  const [ height, setHeight ] = useState<number>(0)

  const [ intervalTimeout, setIntervalTimeout ] = useState<number | null>(null)

  useEffect(() => {
    const canvas = document.getElementById('sineWaveCanvas') as HTMLCanvasElement | null
    if (canvas) {
      const ctx = canvas.getContext('2d')
      if (ctx) {
        console.log('setting context', ctx)
        setCtx(ctx)
        const width = canvas.width = window.innerWidth
        const height = canvas.height
        setWidth(width)
        setHeight(height)
      }
    }
  }, [])

  useEffect(() => {
    
    const now = Date.now()
    if (now > effectStart + effectDuration) {
      setEffectStart(now)
      setEffectDuration(1000)
    }

  }, [state]);

  
  useEffect(() => {

    function animate(time: number) {

      if (!ctx) return

      ctx.clearRect(0, 0, width, height)
      ctx.save()
      ctx.translate(0, height / 2)

      setCurrentTime(time)
      drawWavyLine(ctx, effectStart, effectDuration, width, time, 0.01, 3, 0.002, 100, 'rgba(255, 200, 20, 1)', 'rgba(255, 200, 20, 1)', 10)
      if (time < effectStart + effectDuration) {
        // drawWavyLine(time, 0.01, 8, 0.005, 80, 'rgba(255, 200, 20, 1)', 'rgba(255, 200, 20, 1)', 10)
        // drawWavyLine(time, 0.01, 7, 0.004, 120, 'rgba(255, 200, 20, 1)', 'rgba(255, 200, 20, 1)', 10)
      }
      
      ctx.restore()

    }

    if (intervalTimeout) {
      console.log('clearing interval', intervalTimeout)
      clearInterval(intervalTimeout)
    }


    console.log('effectStart => ', effectStart)
    const newIntervalTimeout = setInterval(() => animate(Date.now()), 1000 / 60) as unknown as number
    setIntervalTimeout(newIntervalTimeout)
  
  }, [effectStart]);

  return (
    <canvas id="sineWaveCanvas" width="100%" height="40px"></canvas>
  )

}