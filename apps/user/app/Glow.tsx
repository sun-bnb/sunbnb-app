'use client'

import { useEffect } from "react";

export default function Glow() {

  useEffect(() => {

    const canvas = document.getElementById('sineWaveCanvas') as HTMLCanvasElement | null;

    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    
    const width = canvas.width = window.innerWidth;
    const height = canvas.height;

    function drawWavyLine(time: number, frequency: number, amplitude: number, speed: number, waveLength: number, color: string, shadowColor: string, shadowBlur: number) {
      
      if (!ctx) return;

      ctx.shadowBlur = shadowBlur;
      ctx.shadowColor = shadowColor;

      ctx.beginPath();
      ctx.moveTo(0, 0);

      for (let x = 0; x < width; x++) {
        const varyingWaveLength = waveLength + (Math.sin((x + time * speed) * frequency) * amplitude) * 0.5;
        const y = Math.sin((x / varyingWaveLength) + time * speed) * amplitude;
        ctx.lineTo(x, y);
      }

      ctx.strokeStyle = color;
      ctx.lineWidth = 4;
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(0, 0);

      for (let x = 0; x < width; x++) {
        const varyingWaveLength = waveLength + (Math.sin((x + time * speed) * frequency) * amplitude) * 0.5;
        const y = Math.sin((x / varyingWaveLength) + time * speed) * amplitude;
        ctx.lineTo(x, y);
      }

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.lineWidth = 4;
      ctx.stroke();
    }

    function animate(time: number) {

      if (!ctx) return;

      ctx.clearRect(0, 0, width, height);
      ctx.save();
      ctx.translate(0, height / 2);

      drawWavyLine(time, 0.01, 6, 0.003, 100, 'rgba(255, 200, 20, 1)', 'rgba(255, 200, 20, 1)', 10);
      drawWavyLine(time, 0.01, 8, 0.005, 80, 'rgba(255, 200, 20, 1)', 'rgba(255, 200, 20, 1)', 10);
      drawWavyLine(time, 0.01, 7, 0.004, 120, 'rgba(255, 200, 20, 1)', 'rgba(255, 200, 20, 1)', 10);

      ctx.restore();
      requestAnimationFrame(animate);
    }

    animate(0);
  
  });

  return (
    <canvas id="sineWaveCanvas" width="100%" height="40px"></canvas>
  )

}