'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import {
  ChartBarIcon,
  ClipboardDocumentListIcon,
  ListBulletIcon,
} from '@heroicons/react/24/solid';
import clsx from 'clsx';

const navItems = [
  {
    label: 'Dashboard',
    href: '/dashboard',
    icon: ChartBarIcon,
  },
  {
    label: 'Órdenes',
    href: '/orders',
    icon: ClipboardDocumentListIcon,
  },
  {
    label: 'Lista',
    href: '/',
    icon: ListBulletIcon,
  },
];

export default function Navbar() {
  const pathname = usePathname();

  return (
    <nav className="bg-white shadow-md border-b px-6 py-3">
      <div className="flex justify-between items-center">
        {/* Ítems de navegación */}
        <ul className="flex gap-2 sm:gap-4 text-sm font-medium text-gray-700">
          {navItems.map(({ label, href, icon: Icon }) => {
            const isActive = pathname === href;
            return (
              <li key={href}>
                <Link
                  href={href}
                  className={clsx(
                    'flex items-center gap-2 px-3 py-2 rounded-md transition-all',
                    isActive
                      ? 'bg-blue-100 text-blue-600 font-semibold shadow-sm'
                      : 'hover:text-blue-600 hover:bg-gray-100'
                  )}
                >
                  <Icon className={clsx('w-5 h-5', isActive ? 'text-blue-600' : 'text-gray-500')} />
                  <span>{label}</span>
                </Link>
              </li>
            );
          })}
        </ul>

        {/* Logo a la derecha */}
        <div className="hidden sm:block">
          <Image
            src="/logo.png" // Asegúrate de tener tu logo en public/logo.png
            alt="Logo Empresa"
            width={40}
            height={40}
            className="rounded-full border border-gray-300"
          />
        </div>
      </div>
    </nav>
  );
}
