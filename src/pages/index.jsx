import dynamic from 'next/dynamic';
import Head from 'next/head';

// Dynamically import the Map component to avoid SSR issues (Leaflet needs window)
const Map = dynamic(() => import('@/components/Map'), { ssr: false });

export default function Home() {
  return (
    <>
      <Head>
        <title>Flight Tracker</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <div className="h-screen w-screen">
        <Map />
      </div>
    </>
  );
}
