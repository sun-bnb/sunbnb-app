import Image from "next/image";
import { Button } from "@repo/ui/button";
import styles from "./page.module.css";

export default function Home() {
  return (
    
    <div className="container mx-auto px-4">
      <nav className="flex items-center justify-between p-4">
        <div> 
          <Button appName="web" className={styles.secondary}>
            Login
          </Button>
        </div>
      </nav>
    </div>
  );
}
