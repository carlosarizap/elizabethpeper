'use client';

import Image from 'next/image';
import { FormEvent, Suspense, useState } from 'react';
import { LockClosedIcon, UserIcon } from '@heroicons/react/24/outline';
import { useRouter, useSearchParams } from 'next/navigation';

function safeReturnPath(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/dashboard';
  return value;
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const result = await response.json().catch(() => null);

      if (!response.ok) {
        setError(result?.error || 'No fue posible iniciar sesión.');
        return;
      }

      router.replace(safeReturnPath(searchParams.get('returnTo')));
      router.refresh();
    } catch {
      setError('No fue posible comunicarse con el servidor.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-10">
      <section className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6 shadow-xl shadow-slate-200/70 sm:p-8">
        <div className="text-center">
          <Image
            src="/logo.png"
            alt="Elizabeth Peper"
            width={72}
            height={72}
            priority
            className="mx-auto rounded-full border border-slate-200"
          />
          <p className="mt-5 text-xs font-bold uppercase tracking-[0.22em] text-blue-600">
            Elizabeth Peper
          </p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-900">
            Iniciar sesión
          </h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            Ingresa tus credenciales para acceder al panel de órdenes.
          </p>
        </div>

        <form className="mt-7 space-y-5" onSubmit={handleSubmit}>
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Usuario</span>
            <span className="mt-2 flex items-center gap-3 rounded-xl border border-slate-300 bg-white px-3 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100">
              <UserIcon className="h-5 w-5 shrink-0 text-slate-400" aria-hidden="true" />
              <input
                type="text"
                name="username"
                autoComplete="username"
                required
                autoFocus
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                className="min-w-0 flex-1 border-0 bg-transparent py-3 text-sm text-slate-900 outline-none"
              />
            </span>
          </label>

          <label className="block">
            <span className="text-sm font-medium text-slate-700">Contraseña</span>
            <span className="mt-2 flex items-center gap-3 rounded-xl border border-slate-300 bg-white px-3 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100">
              <LockClosedIcon className="h-5 w-5 shrink-0 text-slate-400" aria-hidden="true" />
              <input
                type="password"
                name="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="min-w-0 flex-1 border-0 bg-transparent py-3 text-sm text-slate-900 outline-none"
              />
            </span>
          </label>

          {error ? (
            <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={loading}
            className="flex w-full items-center justify-center rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? 'Ingresando…' : 'Ingresar'}
          </button>
        </form>

        <p className="mt-5 text-center text-xs leading-5 text-slate-400">
          La sesión se mantendrá activa en este dispositivo hasta que cierres sesión o borres los datos del navegador.
        </p>
      </section>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={(
        <main className="flex min-h-screen items-center justify-center bg-slate-100">
          <p className="text-sm text-slate-500">Cargando acceso…</p>
        </main>
      )}
    >
      <LoginForm />
    </Suspense>
  );
}
