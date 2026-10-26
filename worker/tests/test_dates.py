import unittest
from datetime import date

from scholarship_worker.dates import find_dates, find_range


def dates(text):
    return [(d.to_date() or (d.month, d.day)) for d in find_dates(text)]


class FindDatesTests(unittest.TestCase):
    def test_english_forms(self):
        self.assertEqual(dates("Deadline: November 30, 2026"), [date(2026, 11, 30)])
        self.assertEqual(dates("until Nov. 30 2026"), [date(2026, 11, 30)])
        self.assertEqual(dates("on 30 November 2026"), [date(2026, 11, 30)])
        self.assertEqual(dates("by Sept 5th, 2027"), [date(2027, 9, 5)])
        self.assertEqual(dates("2027-01-15"), [date(2027, 1, 15)])

    def test_filipino_forms(self):
        self.assertEqual(dates("hanggang Nobyembre 30, 2026"), [date(2026, 11, 30)])
        self.assertEqual(dates("sa ika-15 ng Disyembre 2026"), [date(2026, 12, 15)])
        self.assertEqual(dates("Enero 5, 2027"), [date(2027, 1, 5)])

    def test_day_range_in_one_month(self):
        self.assertEqual(dates("Applications: November 1-30, 2026"), [date(2026, 11, 1), date(2026, 11, 30)])

    def test_missing_year_is_kept_as_month_day(self):
        self.assertEqual(dates("Submit by March 31."), [(3, 31)])
        self.assertIsNone(find_dates("Submit by March 31.")[0].year)

    def test_slash_dates_month_first_and_ambiguity(self):
        [d] = find_dates("Deadline 03/04/2027")
        self.assertEqual(d.to_date(), date(2027, 3, 4))
        self.assertTrue(d.ambiguous)
        [d] = find_dates("Deadline 12/25/2026")
        self.assertFalse(d.ambiguous)

    def test_invalid_dates_and_noise_are_ignored(self):
        self.assertEqual(dates("February 30, 2027"), [])
        self.assertEqual(dates("You may apply online."), [])
        self.assertEqual(dates("Room 2027, Building 3"), [])


class FindRangeTests(unittest.TestCase):
    def test_to_and_until(self):
        first, second = find_range("Applications open from November 1, 2026 to November 30, 2026.")
        self.assertEqual((first.to_date(), second.to_date()), (date(2026, 11, 1), date(2026, 11, 30)))
        first, second = find_range("Mula Enero 5, 2027 hanggang Pebrero 5, 2027")
        self.assertEqual(second.to_date(), date(2027, 2, 5))

    def test_dash_range(self):
        first, second = find_range("November 1-30, 2026")
        self.assertEqual((first.day, second.day), (1, 30))

    def test_unrelated_dates_are_not_a_range(self):
        self.assertIsNone(find_range("Posted October 1, 2026. Deadline is November 30, 2026."))


if __name__ == "__main__":
    unittest.main()
