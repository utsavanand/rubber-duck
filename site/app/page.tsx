import { landingHtml } from "./landing";
import DemoPlayback from "./DemoPlayback";

export default function Home() { return <><main dangerouslySetInnerHTML={{ __html: landingHtml }} /><DemoPlayback /></>; }
