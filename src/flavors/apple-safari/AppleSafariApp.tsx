import AppShell from '../../app/AppShell';
import TurtleVideo from '../../components/TurtleVideo';
import { appleSafariExportRuntime } from './appleSafariExportRuntime';
import { appleSafariPreviewRuntime } from './appleSafariPreviewRuntime';
import { appleSafariSaveRuntime } from './appleSafariSaveRuntime';

function AppleSafariApp() {
  return (
    <AppShell>
      <TurtleVideo
        appFlavor="apple-safari"
        previewRuntime={appleSafariPreviewRuntime}
        exportRuntime={appleSafariExportRuntime}
        saveRuntime={appleSafariSaveRuntime}
      />
    </AppShell>
  );
}

export default AppleSafariApp;