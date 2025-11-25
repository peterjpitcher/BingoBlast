import Link from 'next/link'
import Image from 'next/image'

export function Header() {
  return (
    <header className="sticky top-0 z-50 w-full border-b border-slate-800 bg-slate-950 shadow-md">
      <div className="container mx-auto flex h-16 items-center px-4">
        <Link href="/" className="flex items-center gap-3 hover:opacity-90 transition-opacity">
          <div className="relative h-10 w-10">
            <Image 
              src="/BingoBlast.png" 
              alt="Bingo Blast Logo" 
              fill
              className="object-contain"
              priority
            />
          </div>
          <span className="text-xl font-bold bg-gradient-to-r from-bingo-primary to-bingo-secondary bg-clip-text text-transparent">
            Bingo Blast
          </span>
        </Link>
      </div>
    </header>
  )
}
