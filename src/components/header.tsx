import Link from 'next/link'
import Image from 'next/image'

export function Header() {
  return (
    <header className="sticky top-0 z-50 w-full border-b border-[#1f7c58] bg-[#005131] shadow-md">
      <div className="container mx-auto flex h-16 items-center px-4">
        <Link href="/" className="flex items-center gap-3 hover:opacity-90 transition-opacity">
          <div className="relative h-10 w-10 rounded-full bg-[#00472b] border border-[#1f7c58] p-1">
            <Image 
              src="/the-anchor-pub-logo-white-transparent.png" 
              alt="The Anchor Logo" 
              fill
              className="object-contain"
              priority
            />
          </div>
          <span className="text-xl font-bold text-[#f5f1e6]">
            The Anchor Bingo
          </span>
        </Link>
      </div>
    </header>
  )
}
