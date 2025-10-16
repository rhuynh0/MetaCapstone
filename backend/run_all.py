"""
Run training and prediction scripts in sequence with a single command.

Usage:
  python run_all.py                # runs train.py, train_categorizer.py, then predict.py
  python run_all.py --dry-run      # prints steps without executing heavy imports
  python run_all.py --subprocess   # runs each step in its own Python process (safer)

The --subprocess mode runs each script as a separate Python process; this is
helpful when scripts import heavy native extensions (numpy, scikit-learn).
"""
import argparse
import sys
import os
import traceback
import subprocess


def main(dry_run: bool, use_subprocess: bool) -> int:
    base_dir = os.path.dirname(__file__)
    steps = [
        ("Training URL-based models (train.py)", "train" , "train"),
        ("Training categorizer (train_categorizer.py)", "train_categorizer", "train_categorizer"),
        ("Generating interest profile (predict.py)", "predict", "generate_interest_profile"),
    ]

    if dry_run:
        print("Dry run: the following steps would be executed in order:\n")
        for desc, module_name, func_name in steps:
            if use_subprocess:
                script_path = os.path.join(base_dir, f"{module_name}.py")
                print(f" - {desc}: run `{sys.executable} {script_path}` (subprocess)")
            else:
                print(f" - {desc}: import {module_name}; call {func_name}()")
        print('\nDry run complete. No heavy imports were performed.')
        return 0

    for desc, module_name, func_name in steps:
        print(f"\n==> {desc}")
        try:
            if use_subprocess:
                script_path = os.path.join(base_dir, f"{module_name}.py")
                if not os.path.exists(script_path):
                    raise FileNotFoundError(f"Script not found: {script_path}")
                print(f"Running subprocess: {sys.executable} {script_path}")
                res = subprocess.run([sys.executable, script_path])
                if res.returncode != 0:
                    raise RuntimeError(f"Subprocess for {module_name} exited with code {res.returncode}")
            else:
                # Try importing and calling the expected function
                module = __import__(module_name)
                func = getattr(module, func_name, None)
                if func is None:
                    # fallback: call module.main() if present
                    if hasattr(module, 'main'):
                        print(f"Calling {module_name}.main()")
                        module.main()
                    else:
                        # fallback: run as script using runpy
                        import runpy
                        script_path = os.path.join(base_dir, f"{module_name}.py")
                        if os.path.exists(script_path):
                            print(f"Running {script_path} via runpy")
                            runpy.run_path(script_path, run_name='__main__')
                        else:
                            raise RuntimeError(f"No callable entry found for module {module_name}")
                else:
                    print(f"Calling {module_name}.{func_name}()")
                    func()

        except Exception:
            print(f"Error while running step: {desc}")
            traceback.print_exc()
            return 2

    print("\nAll steps completed successfully.")
    return 0


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Run training + categorizer + prediction in order')
    parser.add_argument('--dry-run', action='store_true', help='Print steps without executing heavy imports')
    parser.add_argument('--subprocess', action='store_true', help='Run each step in a separate Python subprocess (safer for heavy imports)')
    args = parser.parse_args()

    code = main(args.dry_run, args.subprocess)
    sys.exit(code)
