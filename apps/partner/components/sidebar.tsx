import Link from 'next/link';

const Sidebar = () => {
  return (
    <div className="h-screen w-64 bg-gray-800 text-white fixed border-right-1 border-sky-500">
      <div className="p-6">
        <h1 className="text-2xl font-semibold">SunBNB Admin</h1>
      </div>
      <nav className="mt-6">
        <div className="px-4 py-2 hover:bg-gray-700">
          <Link href="/">
            Home
          </Link>
        </div>
        <div className="px-4 py-2 hover:bg-gray-700">
          <Link href="/account">
            Account
          </Link>
        </div>
        <div className="px-4 py-2 hover:bg-gray-700">
          <Link href="/inventory">
            Inventory
          </Link>
        </div>
      </nav>
    </div>
  );
}

export default Sidebar;
