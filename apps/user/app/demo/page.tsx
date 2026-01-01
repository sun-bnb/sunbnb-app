const DEVICE_RATIO = 1179 / 2556
const PHONE_HEIGHT = 1080
const PHONE_WIDTH = Math.round(PHONE_HEIGHT * DEVICE_RATIO)
const PHONE_VERTICAL_BEZEL = 90
const SCREEN_HEIGHT = PHONE_HEIGHT - PHONE_VERTICAL_BEZEL * 2
const IDEAL_SCREEN_WIDTH = SCREEN_HEIGHT * DEVICE_RATIO
const PHONE_HORIZONTAL_BEZEL = Math.max(0, Math.round((PHONE_WIDTH - IDEAL_SCREEN_WIDTH) / 2))
const SCREEN_WIDTH = PHONE_WIDTH - PHONE_HORIZONTAL_BEZEL * 2

export default function DemoPage() {
  return (
    <div className="flex min-h-screen w-full flex-col bg-[#fff5e1] text-slate-900 lg:flex-row lg:justify-between">
      <section className="flex flex-1 flex-col gap-6 px-8 py-12 lg:px-16">
        <span className="text-sm font-semibold uppercase tracking-[0.3em] text-slate-500">Sunbnb preview</span>
        <h1 className="text-4xl font-semibold tracking-tight text-slate-900 lg:text-5xl">Interactive Demo Space</h1>
        <p className="max-w-2xl text-lg leading-relaxed text-slate-700">
          Explore the Sunbnb experience exactly as our guests and partners see it. Use the live device
          preview on the right to navigate through the test environment, while this panel keeps notes,
          talking points, or next steps at hand during walkthroughs.
        </p>
        <div className="grid gap-4 text-base text-slate-700">
          <p>
            The embedded device view mirrors an iPhone 15 Pro, scaled to a tidy 1080 pixel height so it slots neatly
            into workshops, demos, and product reviews without requiring extra window management.
          </p>
          <p>
            Feel free to open new tabs, toggle locales, sign in with staging accounts, or demonstrate booking flows—the
            session runs directly against <span className="font-medium text-slate-900">test.sunbnb.app</span>.
          </p>
        </div>
      </section>
      <aside className="flex flex-col items-center justify-start lg:sticky lg:top-0 lg:ml-auto lg:min-h-screen lg:flex-none">
        <div
          className="flex items-center justify-center"
          style={{ height: `${PHONE_HEIGHT}px`, width: `${PHONE_WIDTH}px` }}
        >
          <div
            className="relative flex h-full w-full flex-col items-center overflow-hidden rounded-[2.8rem] bg-gradient-to-br from-[#0f1013] to-[#1b1c20] shadow-[0_40px_80px_-32px_rgba(0,0,0,0.7),0_0_0_2px_rgba(255,255,255,0.04)]"
            style={{ padding: `${PHONE_VERTICAL_BEZEL}px ${PHONE_HORIZONTAL_BEZEL}px` }}
          >
            <div className="pointer-events-none absolute left-1/2 top-[22px] flex h-[30px] w-[42%] -translate-x-1/2 items-center justify-center gap-[14px] rounded-[1.25rem] bg-black">
              <span className="h-[14px] w-[14px] rounded-full bg-[radial-gradient(circle_at_30%_30%,rgba(81,132,255,0.6),rgba(20,30,50,0.9))]" />
              <span className="h-[8px] w-[70px] rounded-full bg-slate-500/70" />
            </div>
            <iframe
              src="https://test.sunbnb.app/"
              title="Sunbnb test environment"
              className="h-full w-full rounded-[1.6rem] border border-white/10 shadow-inner"
              style={{ width: `${SCREEN_WIDTH}px`, height: `${SCREEN_HEIGHT}px` }}
              loading="lazy"
            />
            <div className="pointer-events-none absolute bottom-6 left-1/2 h-[7px] w-[36%] -translate-x-1/2 rounded-full bg-white/60" />
          </div>
        </div>
      </aside>
    </div>
  )
}
