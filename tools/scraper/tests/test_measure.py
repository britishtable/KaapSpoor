"""Photo measurement helpers."""

from mm_scraper.measure_photos import count_pdf_pages, project


def test_counts_pages_when_the_pdf_omits_the_space_after_type():
    # Google's export writes "/Type/Page"; a literal "/Type /Page" matched none.
    assert count_pdf_pages(b"<</Type/Page>><</Type/Page>>") == 2


def test_page_and_pages_nodes_are_not_confused():
    assert count_pdf_pages(b"<</Type/Pages/Count 2>><</Type/Page>>") == 1


def test_a_body_with_no_pages_counts_zero():
    assert count_pdf_pages(b"not a pdf") == 0


def test_projection_scales_each_tier_by_the_photo_count():
    out = project(total_bytes=1024 * 1024, photo_count=1000)
    assert out["originals_mb"] == 1.0
    assert out["webp_640_q70_mb"] == round(1000 * 66 / 1024, 1)
