import java.io.File;
import java.io.FileInputStream;
import java.util.List;

import org.verapdf.gf.foundry.VeraGreenfieldFoundryProvider;
import org.verapdf.pdfa.Foundries;
import org.verapdf.pdfa.PDFAParser;
import org.verapdf.pdfa.PDFAValidator;
import org.verapdf.pdfa.flavours.PDFAFlavour;
import org.verapdf.pdfa.results.TestAssertion;
import org.verapdf.pdfa.results.ValidationResult;

/**
 * Validate PDFs against a PDF/A flavour.
 *
 * Usage: Validate <flavour> <file>...
 *
 * Exits non-zero if any file fails, printing the rule each failure violated —
 * the clause number is the only useful thing when a conformance check fails,
 * because it points straight at the paragraph of the specification to read.
 */
public final class Validate {
  public static void main(String[] args) throws Exception {
    if (args.length < 2) {
      System.err.println("usage: Validate <flavour> <file>...");
      System.exit(2);
    }

    VeraGreenfieldFoundryProvider.initialise();
    PDFAFlavour flavour = PDFAFlavour.byFlavourId(args[0]);
    if (flavour == PDFAFlavour.NO_FLAVOUR) {
      System.err.println("unknown flavour: " + args[0]);
      System.exit(2);
    }

    boolean allPassed = true;

    for (int index = 1; index < args.length; index++) {
      File file = new File(args[index]);
      try (
        PDFAParser parser = Foundries.defaultInstance()
          .createParser(new FileInputStream(file), flavour);
        PDFAValidator validator = Foundries.defaultInstance().createValidator(flavour, false)
      ) {
        ValidationResult result = validator.validate(parser);

        if (result.isCompliant()) {
          System.out.println("PASS  " + file.getName());
          continue;
        }

        allPassed = false;
        System.out.println("FAIL  " + file.getName());

        List<TestAssertion> assertions = result.getTestAssertions();
        int shown = 0;
        for (TestAssertion assertion : assertions) {
          if (assertion.getStatus() != TestAssertion.Status.FAILED) continue;
          if (shown++ >= 20) {
            System.out.println("      ... and more");
            break;
          }
          System.out.println(
            "      " + assertion.getRuleId().getClause()
              + "-" + assertion.getRuleId().getTestNumber()
              + ": " + assertion.getMessage()
          );
        }
      } catch (Exception failure) {
        allPassed = false;
        System.out.println("ERROR " + file.getName() + ": " + failure);
      }
    }

    System.exit(allPassed ? 0 : 1);
  }
}
