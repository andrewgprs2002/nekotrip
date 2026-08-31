export default function SetupPage() {
  return <main className="authShell">
    <section className="authCard setupCard">
      <div className="eyebrow">NekoTrip v0.3 setup</div>
      <h1>Connect Supabase</h1>
      <ol className="setupSteps">
        <li>Create a Supabase project.</li>
        <li>Run <code>supabase/migrations/0001_foundation.sql</code> in the Supabase SQL Editor.</li>
        <li>Copy the Project URL and Publishable key into <code>.env.local</code>.</li>
        <li>In Supabase Auth URL Configuration, add <code>http://localhost:3000/**</code> as an allowed redirect URL for local development.</li>
        <li>Restart <code>npm.cmd run dev</code>.</li>
      </ol>
      <pre className="envSample">NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co{`\n`}NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...{`\n`}NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=...{`\n`}NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID=</pre>
    </section>
  </main>;
}
